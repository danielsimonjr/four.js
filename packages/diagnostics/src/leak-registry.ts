/**
 * Re-export of `@fourjs/core`'s §83 FinalizationRegistry leak bookkeeping.
 *
 * The implementation moved to core so `@fourjs/geometry`, `@fourjs/render`, and
 * `@fourjs/materials` can register at construction without importing this
 * package (dependency matrix). This file keeps the previous public path.
 */

export {
  auditFinalizedLeaks,
  disposeTracked,
  reportFinalized,
  resetLeakRegistry,
  trackDisposable,
  trackedDisposableId,
} from "@fourjs/core";
