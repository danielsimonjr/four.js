/**
 * Re-export of `@four/core`'s §83 FinalizationRegistry leak bookkeeping.
 *
 * The implementation moved to core so `@four/geometry`, `@four/render`, and
 * `@four/materials` can register at construction without importing this
 * package (dependency matrix). This file keeps the previous public path.
 */

export {
  auditFinalizedLeaks,
  disposeTracked,
  reportFinalized,
  resetLeakRegistry,
  trackDisposable,
  trackedDisposableId,
} from "@four/core";
