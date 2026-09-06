/**
 * §83's **leaked-resource** development warning via `FinalizationRegistry`
 * (A-5 / A-4 remainder, 2026-09-06).
 *
 * The counter audit in `@four/diagnostics` answers a *span* question: did
 * these live-instance counters climb between two readings? This module
 * answers a *lifetime* question: was a disposable constructed, dropped, and
 * then garbage-collected without `dispose()`?
 *
 * Those are different mistakes. A counter audit cannot name the allocation
 * site; a finalizer can, because {@link trackDisposable} captures the stack
 * (or an explicit `creationSite`) at construction.
 *
 * The implementation lives in `@four/core` so `@four/geometry`,
 * `@four/render`, and `@four/materials` can register at construction without
 * importing `@four/diagnostics` (dependency matrix). `@four/diagnostics`
 * re-exports the same functions as the public audit surface.
 *
 * ## Why a queue you drain, and not a warning from the finalizer
 *
 * `FinalizationRegistry` callbacks run at an unspecified time on an
 * unspecified turn. Warning from inside one would make tests racy and would
 * interleave `[four]` lines with whatever the host was doing. So the
 * callback only enqueues `{ label, creationSite }`, and
 * {@link auditFinalizedLeaks} is the call that prints — the same opt-in
 * shape as the counter audit.
 *
 * Because finalization is nondeterministic, tests must not wait for the
 * collector. They call {@link reportFinalized} with the id
 * {@link trackDisposable} returned (or {@link trackedDisposableId} after a
 * constructor has registered), which is the same function the registry
 * uses as its held-value callback.
 *
 * ```ts
 * import { trackDisposable, disposeTracked, auditFinalizedLeaks } from "@four/core";
 *
 * const texture = createTexture();
 * trackDisposable(texture, "level-atlas", "at loadLevel (demo.ts:40)");
 * // …forget to dispose…
 * // later, after GC, or in a test via reportFinalized(id):
 * auditFinalizedLeaks();
 * // [four] §83: "level-atlas" was garbage-collected without dispose(). Creation site: …
 * ```
 *
 * {@link disposeTracked} marks the resource so a later finalization is not a
 * leak. Production (`DEV` false): every function is a no-op.
 */

import { DEV, devWarnOnce } from "./dev.js";

/** Bookkeeping for one {@link trackDisposable} registration. */
interface LeakRecord {
  readonly id: number;
  readonly label: string;
  readonly creationSite: string;
  disposed: boolean;
}

const live = new WeakMap<object, LeakRecord>();
const byId = new Map<number, LeakRecord>();
const pending: LeakRecord[] = [];

let nextId = 1;
let registry: FinalizationRegistry<number> | undefined;

function captureCreationSite(explicit: string | undefined): string {
  if (explicit !== undefined && explicit.length > 0) {
    return explicit;
  }
  const stack = new Error("trackDisposable").stack;
  if (stack === undefined || stack.length === 0) return "unknown";
  const frames: string[] = [];
  for (const line of stack.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    if (trimmed.startsWith("Error")) continue;
    frames.push(trimmed);
  }
  return frames.length > 0 ? frames.join(" ← ") : "unknown";
}

function getRegistry(): FinalizationRegistry<number> | undefined {
  if (typeof FinalizationRegistry === "undefined") return undefined;
  if (registry === undefined) {
    registry = new FinalizationRegistry(reportFinalized);
  }
  return registry;
}

/**
 * Registers `resource` so a GC without {@link disposeTracked} is reported as
 * a leak. Returns a numeric id for {@link reportFinalized}; `0` in production.
 *
 * `creationSite` is recorded as-is when supplied. Otherwise the stack at this
 * call is captured and recorded as the site.
 */
export function trackDisposable(
  resource: object,
  label: string,
  creationSite?: string,
): number {
  if (!DEV) return 0;
  const existing = live.get(resource);
  if (existing !== undefined && !existing.disposed) {
    return existing.id;
  }
  const record: LeakRecord = {
    id: nextId,
    label,
    creationSite: captureCreationSite(creationSite),
    disposed: false,
  };
  nextId += 1;
  live.set(resource, record);
  byId.set(record.id, record);
  const finalizers = getRegistry();
  finalizers?.register(resource, record.id, resource);
  return record.id;
}

/**
 * Marks `resource` as disposed so a later finalization is not a leak.
 * Unregisters the `FinalizationRegistry` entry. A no-op for unknown objects
 * and in production.
 */
export function disposeTracked(resource: object): void {
  if (!DEV) return;
  const record = live.get(resource);
  if (record === undefined) return;
  record.disposed = true;
  live.delete(resource);
  registry?.unregister(resource);
}

/**
 * The id {@link trackDisposable} assigned to `resource`, or `0` when the
 * object is unknown or this is a production build. Test hook: constructors
 * do not return the id, and this is how a suite names it for
 * {@link reportFinalized}.
 */
export function trackedDisposableId(resource: object): number {
  if (!DEV) return 0;
  return live.get(resource)?.id ?? 0;
}

/**
 * Test hook and `FinalizationRegistry` callback: treat `id` as collected.
 *
 * Pushes the record onto the pending-leak queue when it was never disposed.
 * Safe to call with an unknown id (no-op). Production: no-op.
 */
export function reportFinalized(id: number): void {
  if (!DEV) return;
  const record = byId.get(id);
  if (record === undefined) return;
  byId.delete(id);
  if (record.disposed) return;
  pending.push(record);
}

/**
 * Drains finalized-but-never-disposed records and {@link devWarnOnce}s each.
 * Returns how many warnings this call emitted. Production: `0`.
 */
export function auditFinalizedLeaks(): number {
  if (!DEV) return 0;
  let emitted = 0;
  while (pending.length > 0) {
    const record = pending.shift();
    if (record === undefined) break;
    const warned = devWarnOnce(
      `finalized-leak:${String(record.id)}`,
      `§83: "${record.label}" was garbage-collected without dispose(). ` +
        `Creation site: ${record.creationSite}`,
    );
    if (warned) emitted += 1;
  }
  return emitted;
}

/**
 * Forgets every registration and pending leak. Exported for tests, matching
 * {@link resetDevWarnings}.
 */
export function resetLeakRegistry(): void {
  byId.clear();
  pending.length = 0;
  nextId = 1;
  registry = undefined;
}
