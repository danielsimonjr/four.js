/**
 * §83's first development warning — **leaked textures and buffers** (A-4/A-5,
 * 2026-08-07).
 *
 * §83 asks for six development warnings; A-5 (2026-08-07) built the accounting
 * they would have to read — process-wide live-instance counts and byte totals
 * for `BufferGeometry`, `Texture`, and `RenderTarget` — and warned about
 * nothing, because there was no build-mode flag to make a warning free in
 * production. A-4 added `@four/core`'s {@link @four/core!DEV | DEV}, and this
 * module is the first §83 warning to sit behind it.
 *
 * ## Why an audit you call, and not a watcher that runs
 *
 * The obvious implementation is a timer, or a per-frame hook, that compares the
 * counters against the previous frame and warns when they climb. This module
 * deliberately is not that, for two reasons:
 *
 * 1. **A growing counter is not a leak.** Loading a level, streaming a tile,
 *    and building an atlas all raise the totals legitimately and permanently.
 *    Only the *caller* knows which span of program was supposed to end where it
 *    began — one level teardown, one closed editor document, one test case. A
 *    watcher would have to guess, and would therefore either cry wolf or say
 *    nothing.
 * 2. **An ambient timer is itself a diagnostic that never turns off.** §83's
 *    accounting is careful to hold numbers rather than references so that the
 *    tracker cannot be the leak it reports; a background interval would
 *    reintroduce exactly that class of problem — work that runs because a
 *    diagnostic module was imported, in a program that never asked for it.
 *
 * So the shape is: **take a baseline, do the thing, audit**. Nothing runs
 * unless you call it, and the question it answers is the one you asked.
 *
 * ```ts
 * import { liveGeometryCount, geometryMemoryBytes } from "@four/geometry";
 * import { liveTextureCount, liveRenderTargetCount, textureMemoryBytes } from "@four/render";
 * import { auditResourceLeaks, type LiveResourceCounts } from "@four/diagnostics";
 *
 * const read = (): LiveResourceCounts => ({
 *   geometries: liveGeometryCount(),
 *   bufferBytes: geometryMemoryBytes(),
 *   textures: liveTextureCount(),
 *   renderTargets: liveRenderTargetCount(),
 *   textureBytes: textureMemoryBytes(),
 * });
 *
 * const before = read();
 * level.load();
 * level.dispose();
 * auditResourceLeaks(before, read(), { label: "level teardown" });
 * // [four] §83: 3 textures (786432 B) survived "level teardown" without dispose().
 * ```
 *
 * ## Why the counts arrive as plain numbers
 *
 * `@four/diagnostics` may depend on `core`, `math`, and `scene` only (plan
 * §3.1, frozen), so it cannot import `@four/geometry` or `@four/render` to read
 * their totals. Everywhere else in this package that gap is bridged by a
 * *locally declared shape satisfied structurally* (`RenderStatisticsLike`,
 * `DebugBodyAccess`); here, as with `recordResourceMemory`, there is no foreign
 * shape to transcribe — the producers export zero-argument number readers, so
 * {@link LiveResourceCounts} is this module's own record and the caller fills
 * it. That also makes the audit usable against any accounting, including a
 * test's.
 *
 * ## What it costs in production
 *
 * {@link auditResourceLeaks} returns {@link NO_RESOURCE_LEAKS} immediately when
 * `DEV` is `false`, without touching its arguments. A program that leaves the
 * calls in ships the (small) function and pays a branch; a program that wraps
 * them in `if (DEV)` ships nothing at all, which is the documented discipline
 * for every `dev*` helper.
 */

import { DEV, devWarnOnce } from "@four/core";

/**
 * A reading of §83's live-resource accounting, as the caller's packages report
 * it.
 *
 * The five fields are exactly the five zero-argument readers `@four/geometry`
 * and `@four/render` export, in that order:
 * `liveGeometryCount()`, `geometryMemoryBytes()`, `liveTextureCount()`,
 * `liveRenderTargetCount()`, `textureMemoryBytes()`.
 *
 * `bufferBytes` and `textureBytes` are **byte totals, not per-population
 * splits**: `textureBytes` covers textures *and* render targets together,
 * because that is how `textureMemoryBytes()` is defined (§84 names two memory
 * counters, and a target's attachments are textures). The instance counts stay
 * separate, so a report can still say which population grew.
 */
export interface LiveResourceCounts {
  /** Live, undisposed geometries. */
  readonly geometries: number;
  /** Bytes held by those geometries — §84's `bufferMemory`. */
  readonly bufferBytes: number;
  /** Live, undisposed textures. */
  readonly textures: number;
  /** Live, undisposed render targets. */
  readonly renderTargets: number;
  /** Bytes described by textures **and** targets — §84's `textureMemory`. */
  readonly textureBytes: number;
  /**
   * Live, undisposed materials. Optional: `@four/materials` is outside this
   * package's dependency set, so the caller passes the count it already has.
   */
  readonly materials?: number;
  /**
   * Live solver body registrations. Optional; kept beside
   * {@link LiveResourceCounts.solverHandles} so existing call-sites that
   * already filled this field keep working.
   */
  readonly solverBodies?: number;
  /**
   * Live solver handles (bodies, colliders, joints — whatever the caller
   * accounts). Optional: `@four/physics` is outside this package's
   * dependency set (A-5 follow-up: materials + solver handles).
   */
  readonly solverHandles?: number;
}

/**
 * What survived the audited span — every field a difference (`after - before`),
 * clamped at zero because a *negative* difference means resources were disposed
 * and is not what §83's warning is about.
 */
export interface ResourceLeakReport {
  /** `true` when any instance count grew. */
  readonly leaked: boolean;
  /** Geometries constructed and not disposed during the span. */
  readonly geometries: number;
  /** Bytes those geometries hold. */
  readonly bufferBytes: number;
  /** Textures constructed and not disposed during the span. */
  readonly textures: number;
  /** Render targets constructed and not disposed during the span. */
  readonly renderTargets: number;
  /** Bytes the surviving textures and targets describe. */
  readonly textureBytes: number;
  readonly materials: number;
  readonly solverBodies: number;
  readonly solverHandles: number;
  /**
   * The warning text, or `""` when nothing leaked. Always produced (it is what
   * a test asserts on); whether it was *printed* is
   * {@link AuditResourceLeaksOptions.warn}'s business.
   */
  readonly message: string;
}

/** Options for {@link auditResourceLeaks}. */
export interface AuditResourceLeaksOptions {
  /**
   * What the audited span was, quoted in the message and used as the
   * deduplication key — "level teardown", "editor document close". Defaults to
   * `"this span"`.
   *
   * Deduplication is per label because a leak found in a loop is one mistake
   * reported once, not once per iteration; give distinct spans distinct labels.
   */
  readonly label?: string;
  /**
   * Set `false` to compute the report without printing it — the audit becomes a
   * pure function, which is what a test that asserts on the message wants.
   * Defaults to `true`.
   */
  readonly warn?: boolean;
}

/** The report a clean span produces, and the one production always returns. */
export const NO_RESOURCE_LEAKS: ResourceLeakReport = Object.freeze({
  leaked: false,
  geometries: 0,
  bufferBytes: 0,
  textures: 0,
  renderTargets: 0,
  textureBytes: 0,
  materials: 0,
  solverBodies: 0,
  solverHandles: 0,
  message: "",
});

/** `after - before`, never below zero. */
function grew(before: number, after: number): number {
  const difference = after - before;
  return difference > 0 ? difference : 0;
}

/**
 * Compares two readings of §83's accounting and reports — and by default warns
 * once — about resources that were created inside the span and never disposed.
 *
 * Development-only: returns {@link NO_RESOURCE_LEAKS} without reading its
 * arguments when `DEV` is `false`.
 *
 * A resource that the garbage collector reclaimed without a `dispose()` call
 * still counts as leaked, deliberately: §83's contract is that lifetimes are
 * *explicit*, and A-5's accounting never forgives a missing `dispose()`. That
 * is the whole reason these numbers can answer the question at all.
 *
 * @param before counts read before the span
 * @param after counts read after it
 * @returns the difference, and the message describing it
 */
export function auditResourceLeaks(
  before: LiveResourceCounts,
  after: LiveResourceCounts,
  options: AuditResourceLeaksOptions = {},
): ResourceLeakReport {
  if (!DEV) return NO_RESOURCE_LEAKS;

  const geometries = grew(before.geometries, after.geometries);
  const textures = grew(before.textures, after.textures);
  const renderTargets = grew(before.renderTargets, after.renderTargets);
  const materials = grew(before.materials ?? 0, after.materials ?? 0);
  const solverBodies = grew(before.solverBodies ?? 0, after.solverBodies ?? 0);
  const solverHandles = grew(
    before.solverHandles ?? 0,
    after.solverHandles ?? 0,
  );
  if (
    geometries === 0 &&
    textures === 0 &&
    renderTargets === 0 &&
    materials === 0 &&
    solverBodies === 0 &&
    solverHandles === 0
  ) {
    return NO_RESOURCE_LEAKS;
  }

  const bufferBytes = grew(before.bufferBytes, after.bufferBytes);
  const textureBytes = grew(before.textureBytes, after.textureBytes);
  const label = options.label ?? "this span";
  const parts: string[] = [];
  if (geometries > 0) {
    parts.push(`${String(geometries)} geometries (${String(bufferBytes)} B)`);
  }
  if (textures > 0) parts.push(`${String(textures)} textures`);
  if (renderTargets > 0) {
    parts.push(`${String(renderTargets)} render targets`);
  }
  if (materials > 0) {
    parts.push(`${String(materials)} materials`);
  }
  if (solverBodies > 0) {
    parts.push(`${String(solverBodies)} solver body registrations`);
  }
  if (solverHandles > 0) {
    parts.push(`${String(solverHandles)} solver handles`);
  }
  if (textures > 0 || renderTargets > 0) {
    parts.push(`${String(textureBytes)} B of texture memory`);
  }
  const message =
    `§83: ${parts.join(", ")} survived "${label}" without dispose(). ` +
    "Dispose what you construct, or hold the resource deliberately and audit a narrower span.";

  if (options.warn !== false) {
    devWarnOnce(`resource-leak:${label}`, message);
  }

  return {
    leaked: true,
    geometries,
    bufferBytes,
    textures,
    renderTargets,
    textureBytes,
    materials,
    solverBodies,
    solverHandles,
    message,
  };
}
