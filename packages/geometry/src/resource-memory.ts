/**
 * §83 resource accounting for geometries — how many are live, and how many
 * bytes they hold (A-5, 2026-08-07).
 *
 * §83 requires explicit lifetimes for GPU resources and asks the engine to
 * implement "reference counting **or ownership tracking** for shared
 * resources", with a development warning for "leaked textures/buffers". §84
 * then asks an application for `app.stats.bufferMemory`. Neither was
 * answerable while nothing in the repository counted anything: a
 * {@link BufferGeometry} that no one disposed was indistinguishable from one
 * that was never created.
 *
 * This module is the minimal tier that answers both questions for
 * `@four/geometry`. `@four/render`'s `resource-memory.ts` is its twin for
 * textures and render targets, and `@four/diagnostics` bridges the two into
 * §84's `bufferMemory`/`textureMemory` through `recordResourceMemory`.
 *
 * ## Numbers, not references — which is why it cannot leak
 *
 * A tracker that held the resources it tracks would keep every one of them
 * alive for the process's lifetime: it would *be* the leak it exists to report.
 * A `WeakRef` set plus a `FinalizationRegistry` avoids that, but it answers a
 * different question — "was this collected?" rather than "was this disposed?" —
 * and its answers arrive whenever the collector feels like it, which no test
 * and no overlay can depend on.
 *
 * So this module holds **two numbers and no object references at all**. A
 * geometry adds its byte size on construction, adjusts the total by the
 * difference whenever an attribute is replaced, and subtracts it on
 * `dispose()`. The tracker therefore retains nothing, costs O(1) at three
 * points that are all authoring-time events, and never runs on a draw path.
 *
 * ## A resource that is collected without `dispose()` is never subtracted
 *
 * That is the point, not an oversight. §83's contract is that lifetimes are
 * *explicit*; a total that quietly healed itself when the collector got around
 * to a forgotten geometry would hide precisely the leak the counter exists to
 * reveal. A `bufferMemory` that climbs while the scene stays the same size is
 * the §83 "leaked buffers" signal, and it is only a signal because nothing here
 * forgives a missing `dispose()`.
 *
 * ## Process-wide, and absolute
 *
 * The totals cover every live geometry in the JavaScript realm, not those of
 * one application: a geometry belongs to whoever created it (§83), not to an
 * `Application`, and two applications sharing one geometry share its bytes.
 * There is deliberately **no reset**: these are levels, not per-frame
 * accumulations, and zeroing a live total would make it lie for the rest of the
 * session. A test — or a leak hunt — reads the number before and after and
 * compares, which is what {@link geometryMemoryBytes} is shaped for.
 *
 * ## What the byte count is, and is not
 *
 * It is the size of the CPU-side attribute and index arrays the live geometries
 * hold — exactly what a backend uploads for them. It is **not** a query of the
 * driver: a geometry created and never drawn has no GPU buffer yet, and a
 * backend keeps a disposed geometry's buffer until the next frame that meets
 * it. The accounted number is what the engine holds and would upload, which is
 * the number §83's leak question is about, and it is exact rather than
 * approximate.
 */

import { DEV, disposeTracked, trackDisposable } from "@four/core";

/** Live (constructed, undisposed) {@link BufferGeometry} instances. */
let liveGeometries = 0;

/** Bytes held by those instances; see the module header for what counts. */
let liveGeometryBytes = 0;

/**
 * Records a change to the live geometry accounting: `instances` is `+1` at
 * construction, `-1` at disposal, and `0` for a mutation; `bytes` is the signed
 * change in held bytes.
 *
 * Internal to `@four/geometry` — exported so `buffer-geometry.ts` can reach it,
 * deliberately absent from the package index, exactly as `@four/math`'s
 * `noteConstruction` is (`alloc-counter.ts`).
 */
export function noteGeometry(instances: number, bytes: number): void {
  liveGeometries += instances;
  liveGeometryBytes += bytes;
}

/**
 * Bytes held by every live geometry — §84's `bufferMemory` (§83).
 *
 * ```ts
 * const before = geometryMemoryBytes();
 * const geometry = boxGeometry({ width: 1, height: 1, depth: 1 });
 * geometryMemoryBytes() - before; // === geometry.byteLength
 * geometry.dispose();
 * geometryMemoryBytes(); // === before
 * ```
 *
 * Reading it allocates nothing and costs one property read, so a diagnostics
 * overlay may sample it every frame. See the module header for why the value is
 * process-wide, absolute, and never healed by garbage collection.
 */
export function geometryMemoryBytes(): number {
  return liveGeometryBytes;
}

/**
 * How many geometries have been constructed and not yet disposed (§83).
 *
 * The instance-count half of the same accounting: a count that grows across
 * identical frames is the "leaked buffers" warning §83 asks for, and it stays
 * meaningful for geometries whose byte size is zero.
 */
export function liveGeometryCount(): number {
  return liveGeometries;
}

/**
 * Registers `resource` with §83's FinalizationRegistry tracker (A-4).
 * Call at construction beside {@link noteGeometry}. Production: no-op.
 */
export function trackGeometryDisposable(resource: object, label: string): void {
  if (DEV) trackDisposable(resource, label);
}

/**
 * Marks `resource` disposed so a later finalization is not a leak.
 * Call from `dispose()` beside the {@link noteGeometry} decrement.
 */
export function releaseGeometryDisposable(resource: object): void {
  if (DEV) disposeTracked(resource);
}
