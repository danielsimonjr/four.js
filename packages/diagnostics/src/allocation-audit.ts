/**
 * §83's "excessive per-frame allocations" development warning (A-4/A-5,
 * 2026-09-06).
 *
 * `@four/math`'s {@link @four/math!constructionCount | constructionCount} is
 * the instrument benchmarks use to prove zero steady-state allocation (§7b).
 * This module turns two readings of that counter into a one-time warning —
 * the same opt-in, caller-driven shape as {@link auditResourceLeaks}:
 *
 * ```ts
 * import { constructionCount, resetConstructionCount } from "@four/math";
 * import { auditFrameAllocations } from "@four/diagnostics";
 *
 * resetConstructionCount();
 * warmUp();
 * const before = constructionCount();
 * simulateOneFrame();
 * auditFrameAllocations(before, constructionCount(), { label: "simulate" });
 * ```
 *
 * Nothing runs unless you call it, and production builds return
 * {@link NO_FRAME_ALLOCATIONS} without touching the arguments.
 */

import { DEV, devWarnOnce } from "@four/core";

/** What grew across the audited span. */
export interface FrameAllocationReport {
  /** `true` when {@link FrameAllocationReport.constructed} exceeds the threshold. */
  readonly excessive: boolean;
  /** Math objects constructed during the span (`after - before`, clamped at zero). */
  readonly constructed: number;
  /**
   * The warning text, or `""` when nothing exceeded the threshold. Whether it
   * printed is {@link AuditFrameAllocationsOptions.warn}'s business.
   */
  readonly message: string;
}

/** Options for {@link auditFrameAllocations}. */
export interface AuditFrameAllocationsOptions {
  /**
   * What the audited span was — quoted in the message and used as the
   * deduplication key. Defaults to `"this frame"`.
   */
  readonly label?: string;
  /**
   * How many {@link @four/math!constructionCount | constructionCount}
   * constructions are allowed before warning. Defaults to `0` — steady-state
   * engine code should allocate none (§7b).
   */
  readonly threshold?: number;
  /**
   * Set `false` to compute the report without printing. Defaults to `true`.
   */
  readonly warn?: boolean;
}

/** The report a clean span produces, and the one production always returns. */
export const NO_FRAME_ALLOCATIONS: FrameAllocationReport = Object.freeze({
  excessive: false,
  constructed: 0,
  message: "",
});

/** `after - before`, never below zero. */
function grew(before: number, after: number): number {
  const difference = after - before;
  return difference > 0 ? difference : 0;
}

/**
 * Compares two {@link @four/math!constructionCount | constructionCount}
 * readings and reports — and by default warns once — when the span allocated
 * more math objects than the threshold allows.
 *
 * Development-only: returns {@link NO_FRAME_ALLOCATIONS} when `DEV` is `false`.
 */
export function auditFrameAllocations(
  before: number,
  after: number,
  options: AuditFrameAllocationsOptions = {},
): FrameAllocationReport {
  if (!DEV) return NO_FRAME_ALLOCATIONS;

  const threshold = options.threshold ?? 0;
  const constructed = grew(before, after);
  if (constructed <= threshold) {
    return NO_FRAME_ALLOCATIONS;
  }

  const label = options.label ?? "this frame";
  const message =
    `§83: ${String(constructed)} @four/math object(s) were constructed during ` +
    `"${label}" (threshold ${String(threshold)}); steady-state per-frame code ` +
    "should reuse out-parameters and pooled buffers (§7b).";

  if (options.warn !== false) {
    devWarnOnce(`per-frame-alloc:${label}`, message);
  }

  return { excessive: true, constructed, message };
}
